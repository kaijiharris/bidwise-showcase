import http from 'k6/http';
import { check, sleep } from 'k6';

// Test configuration
export const options = {
  // Key stages of the load test
  stages: [
    { duration: '30s', target: 20 },  // Ramp-up to 20 users over 30 seconds
    { duration: '1m', target: 20 },   // Stay at 20 users for 1 minute
    { duration: '30s', target: 50 },  // Spike to 50 users over 30 seconds
    { duration: '1m', target: 50 },   // Stay at 50 users for 1 minute
    { duration: '30s', target: 0 },   // Ramp-down to 0 users
  ],
  
  // Define thresholds for success/failure
  thresholds: {
    // 95% of requests should complete within 500ms
    http_req_duration: ['p(95)<500'], 
    // Less than 1% of requests should fail
    http_req_failed: ['rate<0.01'],   
  },
};

// Base URL of your application (change to production URL if testing production)
const BASE_URL = 'http://localhost:3000';

export default function () {
  // 1. Test the main dashboard page
  const dashboardRes = http.get(`${BASE_URL}/`);
  
  check(dashboardRes, {
    'Dashboard status is 200': (r) => r.status === 200,
    // Adjust this based on an actual element or text on your page
    // 'Dashboard loaded correctly': (r) => r.body.includes('BidWise'), 
  });

  // Small pause to simulate real user thinking time
  sleep(1);

  // 2. Test an API endpoint (Example: fetching auction data or deals)
  // Uncomment and adjust the path based on your actual API routes
  /*
  const apiRes = http.get(`${BASE_URL}/api/deals`);
  check(apiRes, {
    'API status is 200': (r) => r.status === 200,
    'API returns JSON': (r) => r.headers['Content-Type'] && r.headers['Content-Type'].includes('application/json'),
  });
  sleep(1);
  */
}
