describe('logger', () => {
  const originalEnv = process.env;

  async function loadLogger(env: Record<string, string | undefined>) {
    process.env = { ...originalEnv, LOG_LEVEL: undefined, NODE_ENV: undefined, ...env };
    const add = jest.fn();
    const created = { add };
    const createLogger = jest.fn().mockReturnValue(created);
    const Console = jest.fn();
    const File = jest.fn();
    const winston = {
      createLogger,
      format: {
        combine: jest.fn(),
        timestamp: jest.fn(),
        errors: jest.fn(),
        splat: jest.fn(),
        json: jest.fn(),
        colorize: jest.fn(),
        simple: jest.fn(),
      },
      transports: { Console, File },
    };
    let logger: unknown;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('winston', () => ({ __esModule: true, default: winston }));
      logger = (await import('./logger')).logger;
    });
    return { logger, created, add, createLogger, Console, File };
  }

  afterEach(() => {
    process.env = originalEnv;
    jest.dontMock('winston');
  });

  it('exports the created logger tagged with the service name', async () => {
    const { logger, created, createLogger } = await loadLogger({});
    expect(logger).toBe(created);
    expect(createLogger).toHaveBeenCalledWith(expect.objectContaining({ defaultMeta: { service: 'secretly-bot' } }));
  });

  it('logs at info level by default', async () => {
    const { createLogger } = await loadLogger({});
    expect(createLogger).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }));
  });

  it('logs at the level given by LOG_LEVEL', async () => {
    const { createLogger } = await loadLogger({ LOG_LEVEL: 'debug' });
    expect(createLogger).toHaveBeenCalledWith(expect.objectContaining({ level: 'debug' }));
  });

  it('writes to the console only outside production', async () => {
    const { Console, File, add } = await loadLogger({ NODE_ENV: 'development' });
    expect(Console).toHaveBeenCalledTimes(1);
    expect(File).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('also writes error and combined log files in production', async () => {
    const { File, add } = await loadLogger({ NODE_ENV: 'production' });
    expect(add).toHaveBeenCalledTimes(2);
    expect(File).toHaveBeenCalledWith(expect.objectContaining({ filename: 'error.log', level: 'error' }));
    expect(File).toHaveBeenCalledWith(expect.objectContaining({ filename: 'combined.log' }));
  });
});
