/**
 * Sampling Audit Module
 * Observational audit pass for time sampling behavior in GPX points
 * Does NOT mutate, reorder, or normalize timestamps
 * Collects positive time deltas between consecutive valid timestamps
 * Also collects distance deltas using haversine formula
 */

/**
 * Calculates haversine distance between two points in meters
 * @param {number} lat1 - Latitude of first point in degrees
 * @param {number} lon1 - Longitude of first point in degrees
 * @param {number} lat2 - Latitude of second point in degrees
 * @param {number} lon2 - Longitude of second point in degrees
 * @returns {number} Distance in meters
 */

//IMPORTANT NOTE TO SELF: "Presence of timestamps enables time-conditioned distance audit; does NOT imply time-based sampling."
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Audits time sampling behavior by collecting positive time deltas
 * Also collects distance deltas between consecutive valid points
 * @param {Array} points - Array of point objects with timeRaw, lat, lon properties
 * @param {string} [gpxFilename] - Optional GPX filename (without extension) to include in download filenames
 * @returns {Object} Object containing time delta and distance delta statistics
 */
function auditSampling(points, gpxFilename) {
  const timeDeltasMs = [];
  const distanceDeltasM = [];
  let previousTimestampMs = null;
  let previousPoint = null; // Track previous point with valid coordinates
  let hasValidTimestamps = false; // Track if we've seen any valid timestamps
  
  // First pass: determine if we have any valid timestamps
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const timeRaw = point.timeRaw;
    if (timeRaw !== null) {
      const timestampMs = Date.parse(timeRaw);
      if (!isNaN(timestampMs)) {
        hasValidTimestamps = true;
        break;
      }
    }
  }
  
  // Iterate through all points in order
  // Note: All points are assumed to have valid coordinates (validated during ingestion)
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const timeRaw = point.timeRaw;
    
    // Process timestamp for time delta calculation
    let currentTimestampMs = null;
    let hasValidTimestamp = false;
    
    if (timeRaw !== null) {
      currentTimestampMs = Date.parse(timeRaw);
      hasValidTimestamp = !isNaN(currentTimestampMs);
    }
    
    // Compute time delta if we have valid timestamps
    if (hasValidTimestamp) {
      if (previousTimestampMs !== null) {
        const delta = currentTimestampMs - previousTimestampMs;
        
        // Collect only positive deltas (delta > 0)
        if (delta > 0) {
          timeDeltasMs.push(delta);
          
          // If timestamps exist and ordering is known, compute distance delta for this pair
          if (previousPoint !== null) {
            const distance = haversineDistance(
              previousPoint.lat,
              previousPoint.lon,
              point.lat,
              point.lon
            );
            
            // Ignore invalid, zero, or non-finite distances
            if (isFinite(distance) && distance > 0) {
              distanceDeltasM.push(distance);
            }
          }
        }
      }
      previousTimestampMs = currentTimestampMs;
    } else if (!hasValidTimestamps) {
      // If timestamps are missing entirely, compute distance for all consecutive points
      if (previousPoint !== null) {
        const distance = haversineDistance(
          previousPoint.lat,
          previousPoint.lon,
          point.lat,
          point.lon
        );
        
        // Ignore invalid, zero, or non-finite distances
        if (isFinite(distance) && distance > 0) {
          distanceDeltasM.push(distance);
        }
      }
    }
    
    // Update previous point (coordinates are already validated during ingestion)
    previousPoint = { lat: point.lat, lon: point.lon };
  }
  
  // Calculate statistics
  const totalDeltaCount = timeDeltasMs.length;
  let minDeltaMs = null;
  let maxDeltaMs = null;
  let medianDeltaMs = null;
  
  if (totalDeltaCount > 0) {
    // Sort deltas for median calculation
    const sortedDeltas = [...timeDeltasMs].sort((a, b) => a - b);
    
    minDeltaMs = sortedDeltas[0];
    maxDeltaMs = sortedDeltas[sortedDeltas.length - 1];
    
    // Calculate median
    const mid = Math.floor(sortedDeltas.length / 2);
    if (sortedDeltas.length % 2 === 0) {
      // Even number of elements: average of two middle values
      medianDeltaMs = (sortedDeltas[mid - 1] + sortedDeltas[mid]) / 2;
    } else {
      // Odd number of elements: middle value
      medianDeltaMs = sortedDeltas[mid];
    }
  }
  
  // Build result object
  const result = {
    timeDeltasMs: timeDeltasMs,
    totalDeltaCount: totalDeltaCount,
    minDeltaMs: minDeltaMs,
    maxDeltaMs: maxDeltaMs,
    medianDeltaMs: medianDeltaMs,
    distanceDeltasM: distanceDeltasM
  };
  
  // Console log the audit results
  console.log('=== Sampling Audit Results ===');
  console.log('Total positive deltas collected:', totalDeltaCount);
  if (totalDeltaCount > 0) {
    console.log('Minimum delta (ms):', minDeltaMs);
    console.log('Maximum delta (ms):', maxDeltaMs);
    console.log('Median delta (ms):', medianDeltaMs);
    console.log('Minimum delta (seconds):', Math.round(minDeltaMs / 1000));
    console.log('Maximum delta (seconds):', Math.round(maxDeltaMs / 1000));
    console.log('Median delta (seconds):', Math.round(medianDeltaMs / 1000));
  } else {
    console.log('No positive deltas found (insufficient valid consecutive timestamps)');
  }
  console.log('Total distance deltas collected:', distanceDeltasM.length);
  console.log('================================');
  
  // Extract base filename (without extension) for download filenames
  const baseFilename = gpxFilename ? gpxFilename.replace(/\.gpx$/i, '') : 'gpx';
  
  // Export time deltas to JSON file
  const timeExportPayload = {
    deltas: timeDeltasMs,
    count: timeDeltasMs.length
  };
  
  const timeJsonString = JSON.stringify(timeExportPayload, null, 2);
  const timeBlob = new Blob([timeJsonString], { type: 'application/json' });
  const timeUrl = URL.createObjectURL(timeBlob);
  const timeLink = document.createElement('a');
  timeLink.href = timeUrl;
  timeLink.download = `${baseFilename}_time_deltas.json`;
  document.body.appendChild(timeLink);
  timeLink.click();
  document.body.removeChild(timeLink);
  URL.revokeObjectURL(timeUrl);
  
  // Export distance deltas to JSON file
  const distanceExportPayload = {
    deltas: distanceDeltasM,
    count: distanceDeltasM.length
  };
  
  const distanceJsonString = JSON.stringify(distanceExportPayload, null, 2);
  const distanceBlob = new Blob([distanceJsonString], { type: 'application/json' });
  const distanceUrl = URL.createObjectURL(distanceBlob);
  const distanceLink = document.createElement('a');
  distanceLink.href = distanceUrl;
  distanceLink.download = `${baseFilename}_distance_deltas.json`;
  document.body.appendChild(distanceLink);
  distanceLink.click();
  document.body.removeChild(distanceLink);
  URL.revokeObjectURL(distanceUrl);
  
  return result;
}
