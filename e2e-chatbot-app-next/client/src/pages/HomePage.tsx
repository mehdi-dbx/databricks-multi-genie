import useSWR from 'swr';
import { Database, ExternalLink } from 'lucide-react';

interface GenieSpace {
  space_id: string;
  title: string;
}

interface Workspace {
  url: string;
  spaces: GenieSpace[];
}

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

function workspaceLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function HomePage() {
  const { data, error, isLoading } = useSWR<Workspace[]>('/api/workspaces', fetcher);

  return (
    <div className="flex h-full flex-1 flex-col overflow-auto p-6">
      <h1 className="mb-6 font-semibold text-xl text-foreground">Genie Spaces</h1>

      {isLoading && (
        <p className="text-muted-foreground text-sm">Loading workspaces…</p>
      )}

      {error && (
        <p className="text-destructive text-sm">Failed to load workspaces.</p>
      )}

      {data && (
        <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {data.map((ws) => (
            <div
              key={ws.url}
              className="rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className="mb-3 flex items-center gap-2">
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                <a
                  href={ws.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-medium text-sm text-foreground hover:underline"
                  title={ws.url}
                >
                  {workspaceLabel(ws.url)}
                </a>
                <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                  {ws.spaces.length}
                </span>
              </div>

              {ws.spaces.length === 0 ? (
                <p className="text-muted-foreground text-xs">No Genie Spaces found.</p>
              ) : (
                <ul className="space-y-1">
                  {ws.spaces.map((space) => (
                    <li key={space.space_id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50">
                      <Database className="h-3.5 w-3.5 shrink-0 text-purple-500" />
                      <span className="truncate text-sm text-foreground">{space.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
