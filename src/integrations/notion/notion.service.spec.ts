import { NotionService } from './notion.service.js';

describe('NotionService – search result title extraction', () => {
  let service: NotionService;

  beforeEach(() => {
    service = new NotionService({
      get: () => ({
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost/callback',
        timeoutMs: 30_000,
      }),
    } as never);
  });

  it('is instantiated without throwing', () => {
    expect(service).toBeDefined();
  });
});

describe('NotionService – API header construction', () => {
  it('includes Notion-Version header via service internals', () => {
    const service = new NotionService({
      get: () => ({
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost/callback',
        timeoutMs: 30_000,
      }),
    } as never);

    // Access the private method via type assertion for testing
    const headers = (service as unknown as {
      apiHeaders: (t: string) => Record<string, string>;
    }).apiHeaders('test-token');

    expect(headers['Notion-Version']).toBe('2022-06-28');
    expect(headers['Authorization']).toBe('Bearer test-token');
  });
});
