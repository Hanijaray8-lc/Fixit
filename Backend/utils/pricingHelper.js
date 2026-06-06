
export const calculateWorkerPriceRange = (servicePricing) => {
  if (!servicePricing || servicePricing.length === 0) {
    return { min: 200, max: 650 }; // safe fallback default range
  }

  const minPrices = servicePricing
    .map(item => {
      // 1. Try priceRange.min
      if (item.priceRange && item.priceRange.min !== undefined && item.priceRange.min !== null) {
        return Number(item.priceRange.min);
      }
      // 2. Try item.min
      if (item.min !== undefined && item.min !== null) {
        return Number(item.min);
      }
      // 3. Fallback to workerPrice
      return Number(item.workerPrice);
    })
    .filter(p => !isNaN(p) && p !== null && p > 0);

  const maxPrices = servicePricing
    .map(item => {
      // 1. Try priceRange.max
      if (item.priceRange && item.priceRange.max !== undefined && item.priceRange.max !== null) {
        return Number(item.priceRange.max);
      }
      // 2. Try item.max
      if (item.max !== undefined && item.max !== null) {
        return Number(item.max);
      }
      // 3. Fallback to workerPrice
      return Number(item.workerPrice);
    })
    .filter(p => !isNaN(p) && p !== null && p > 0);

  if (minPrices.length === 0 || maxPrices.length === 0) {
    return { min: 200, max: 650 }; // default fallback range
  }

  return {
    min: Math.min(...minPrices),
    max: Math.max(...maxPrices)
  };
};

export const normalizeServicePricing = (servicePricing, serviceName, getDefaultServicePricing) => {
  if (!servicePricing || servicePricing.length === 0) {
    return getDefaultServicePricing(serviceName);
  }

  const defaults = getDefaultServicePricing(serviceName);

  return servicePricing.map(item => {
    const itemObj = item.toObject ? item.toObject() : item;
    
    // If it already has priceRange with valid min and max, keep it
    if (itemObj.priceRange && itemObj.priceRange.min !== undefined && itemObj.priceRange.min !== null) {
      return itemObj;
    }

    // Try to find matching default work type
    const defaultMatch = defaults.find(d => String(d.work).toLowerCase().trim() === String(itemObj.work).toLowerCase().trim());
    if (defaultMatch && defaultMatch.priceRange) {
      return {
        ...itemObj,
        priceRange: {
          min: defaultMatch.priceRange.min,
          max: defaultMatch.priceRange.max
        }
      };
    }

    // Otherwise construct a range around workerPrice/defaultPrice
    const priceVal = Number(itemObj.workerPrice || itemObj.defaultPrice || 250);
    return {
      ...itemObj,
      priceRange: {
        min: Math.max(0, Math.round(priceVal * 0.8)),
        max: Math.round(priceVal * 1.5)
      }
    };
  });
};
