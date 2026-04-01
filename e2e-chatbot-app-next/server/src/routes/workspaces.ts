import { Router, type Request, type Response } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth';

export const workspacesRouter = Router();
workspacesRouter.use(authMiddleware);

/**
 * GET /api/workspaces - Proxy to backend /workspaces
 * Returns [{ url: string, spaces: { space_id: string, title: string }[] }]
 */
workspacesRouter.get('/', requireAuth, async (_req: Request, res: Response) => {
  const apiProxy = process.env.API_PROXY || '';
  let base = apiProxy.replace(/\/invocations\/?$/, '') || 'http://127.0.0.1:8000';
  if (base.startsWith('http://localhost:') || base.startsWith('https://localhost:')) {
    base = base.replace('localhost', '127.0.0.1');
  }
  const url = `${base}/workspaces`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      console.error('[workspaces] backend error', response.status, text.slice(0, 200));
      return res.status(response.status).json({ error: 'Backend error', details: text.slice(0, 200) });
    }
    const data = await response.json();
    return res.json(data);
  } catch (err) {
    console.error('[workspaces] fetch error', url, err);
    return res.status(502).json({
      error: 'Backend unavailable',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
