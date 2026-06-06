// fetchRoutes.js
import express from 'express';
import { fetchBusinesses } from '../apifyFetch.js';

const router = express.Router();

// GET /api/fetch?service=plumber&city=Madurai&lat=9.9252&lon=78.1198
router.get('/', async (req, res) => {
    const { service, city, lat, lon } = req.query;

    if (!service) {
        return res.status(400).json({ 
            success: false, 
            error: 'service is required. Example: /api/fetch?service=plumber&city=Madurai' 
        });
    }

    if (!city && (!lat || !lon)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Either city OR coordinates (lat and lon) must be provided.' 
        });
    }

    try {
        // Call the business fetching service with coordinate support
        const businesses = await fetchBusinesses(service, city, lat, lon);

        // Send success response
        res.json({
            success: true,
            count: businesses.length,
            data: businesses  // This includes name, phone, address, rating, etc.
        });
    } catch (error) {
        console.error('Route error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch data' 
        });
    }
});

export default router;