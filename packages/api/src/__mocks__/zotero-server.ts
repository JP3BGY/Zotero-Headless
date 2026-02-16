// Mock Zotero API Server for Testing
// Based on TDD_EXECUTION_PLAN.md Section 2.1

import { http, HttpResponse, delay } from 'msw';

// Mock data storage
export const mockStore = {
  users: new Map(),
  items: new Map(),
  collections: new Map(),
  tags: new Map(),
};

// Initialize mock data
function initializeMockData(userId: string) {
  if (!mockStore.users.has(userId)) {
    mockStore.users.set(userId, {
      userID: userId,
      username: 'testuser',
      libraries: [{ libraryID: userId, type: 'user', name: 'Test Library' }],
    });
  }
}

// API Key validation
const VALID_API_KEYS = ['test-api-key-123', 'valid-key-456'];

// Rate limiting
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const requests = rateLimitMap.get(key) || [];
  const recentRequests = requests.filter(t => now - t < windowMs);
  
  if (recentRequests.length >= 35) { // Zotero limit is 35/min
    return false;
  }
  
  recentRequests.push(now);
  rateLimitMap.set(key, recentRequests);
  return true;
}

// Create handlers
export function createHandlers(userId: string = '12345') {
  initializeMockData(userId);
  
  return [
    // Verify API key
    http.get('/users/:userId', async ({ request }) => {
      const url = new URL(request.url);
      const apiKey = url.searchParams.get('key');
      
      if (!apiKey || !VALID_API_KEYS.includes(apiKey)) {
        return HttpResponse.json(
          { error: 'Invalid API key', status: 403 },
          { status: 403 }
        );
      }
      
      return HttpResponse.json({
        userID: userId,
        username: 'testuser',
        libraries: [
          { libraryID: userId, type: 'user', name: 'Test Library', version: 100 }
        ]
      });
    }),

    // Get library version
    http.get('/users/:userId', async ({ params }) => {
      return HttpResponse.json({
        users: [{
          userID: params.userId,
          libraryVersion: 100
        }]
      });
    }),

    // Get items
    http.get('/users/:userId/items', async ({ params, request }) => {
      const url = new URL(request.url);
      const apiKey = url.searchParams.get('key');
      
      if (!checkRateLimit(apiKey || '')) {
        return HttpResponse.json(
          { error: 'Rate limit exceeded', status: 429 },
          { status: 429 }
        );
      }
      
      const items = Array.from(mockStore.items.values())
        .filter(item => item.library === params.userId);
      
      return HttpResponse.json(items, {
        headers: { 'Total-Results': String(items.length) }
      });
    }),

    // Get single item
    http.get('/users/:userId/items/:itemKey', async ({ params }) => {
      const item = mockStore.items.get(`${params.userId}/${params.itemKey}`);
      
      if (!item) {
        return HttpResponse.json(
          { error: 'Item not found', status: 404 },
          { status: 404 }
        );
      }
      
      return HttpResponse.json([item]);
    }),

    // Create item
    http.post('/users/:userId/items', async ({ params, request }) => {
      const body = await request.json() as any[];
      const newItems = body.map((item, index) => ({
        key: `NEWITEM${Date.now()}${index}`,
        version: 1,
        data: item,
        library: params.userId,
      }));
      
      for (const item of newItems) {
        mockStore.items.set(`${params.userId}/${item.key}`, item);
      }
      
      return HttpResponse.json(newItems, { status: 200 });
    }),

    // Update item
    http.patch('/users/:userId/items/:itemKey', async ({ params, request }) => {
      const body = await request.json() as any;
      const key = `${params.userId}/${params.itemKey}`;
      const existing = mockStore.items.get(key);
      
      if (!existing) {
        return HttpResponse.json(
          { error: 'Item not found', status: 404 },
          { status: 404 }
        );
      }
      
      const updated = {
        ...existing,
        ...body,
        version: existing.version + 1,
      };
      
      mockStore.items.set(key, updated);
      return HttpResponse.json([updated]);
    }),

    // Delete item (trash)
    http.delete('/users/:userId/items/:itemKey', async ({ params }) => {
      const key = `${params.userId}/${params.itemKey}`;
      const existing = mockStore.items.get(key);
      
      if (!existing) {
        return HttpResponse.json(
          { error: 'Item not found', status: 404 },
          { status: 404 }
        );
      }
      
      // Soft delete
      existing.data.deleted = true;
      existing.version += 1;
      mockStore.items.set(key, existing);
      
      return HttpResponse.json([existing], { status: 204 });
    }),

    // Get collections
    http.get('/users/:userId/collections', async () => {
      const collections = Array.from(mockStore.collections.values());
      return HttpResponse.json(collections);
    }),

    // Get tags
    http.get('/users/:userId/tags', async () => {
      const tags = Array.from(mockStore.tags.values());
      return HttpResponse.json(tags);
    }),
  ];
}

// Helper to reset mock store
export function resetMockStore() {
  mockStore.users.clear();
  mockStore.items.clear();
  mockStore.collections.clear();
  mockStore.tags.clear();
  rateLimitMap.clear();
}

// Add test items to mock store
export function addTestItems(userId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const item = {
      key: `TEST${String(i).padStart(4, '0')}`,
      version: 1,
      library: userId,
      data: {
        itemType: 'journalArticle',
        title: `Test Article ${i}`,
        creators: [{ firstName: 'Author', lastName: `${i}` }],
        date: '2024-01-01',
      }
    };
    mockStore.items.set(`${userId}/${item.key}`, item);
  }
}
