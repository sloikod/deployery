import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      containerProps={{
        style: {
          gridTemplate: `"sidebar . header toc ."
"sidebar . toc-popover toc ."
"sidebar . main toc ." 1fr / var(--fd-sidebar-col) minmax(min-content, 1fr) minmax(0, calc(var(--fd-layout-width, 97rem) - var(--fd-sidebar-width) - var(--fd-toc-width))) var(--fd-toc-width) minmax(min-content, 1fr)`,
        },
      }}
      {...baseOptions()}
    >
      {children}
    </DocsLayout>
  );
}
