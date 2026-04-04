import type { CSSProperties, ReactNode } from 'react';

interface SkeletonProps {
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
}

const Skeleton = ({ className = '', style, children }: SkeletonProps) => (
    <div className={`animate-pulse rounded-md bg-app-border/60 ${className}`} style={style}>
        {children}
    </div>
);

interface SkeletonCardProps {
    count?: number;
}

export const SkeletonCard = ({ count = 1 }: SkeletonCardProps) => (
    <>
        {Array.from({ length: count }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton placeholders are static, order never changes
            <div key={i} className="rounded-xl border border-app-border bg-app-surface p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                    <Skeleton className="h-5 w-5 rounded-full" />
                    <Skeleton className="h-5 w-28" />
                </div>
                <Skeleton className="mb-2 h-4 w-full" />
                <Skeleton className="mb-2 h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
            </div>
        ))}
    </>
);

interface SkeletonTextProps {
    lines?: number;
    width?: string;
}

export const SkeletonText = ({ lines = 3, width = 'w-full' }: SkeletonTextProps) => (
    <>
        {Array.from({ length: lines }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton lines are static
            <Skeleton key={i} className={`mb-2 h-4 ${i === lines - 1 ? 'w-2/3' : width}`} />
        ))}
    </>
);

interface SkeletonTableProps {
    rows?: number;
    cols?: number;
}

export const SkeletonTable = ({ rows = 4, cols = 3 }: SkeletonTableProps) => (
    <div className="space-y-3">
        <div className="flex gap-3">
            {Array.from({ length: cols }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton cells are static
                <Skeleton key={i} className="h-6 flex-1" />
            ))}
        </div>
        {Array.from({ length: rows }).map((_, rowIdx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton rows are static
            <div key={rowIdx} className="flex gap-3">
                {Array.from({ length: cols }).map((_, colIdx) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton cells are static
                    <Skeleton key={colIdx} className="h-8 flex-1" />
                ))}
            </div>
        ))}
    </div>
);

export default Skeleton;
