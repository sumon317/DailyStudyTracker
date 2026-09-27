import type { CSSProperties, ReactNode } from 'react';

interface SkeletonProps {
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
}

interface SkeletonCardProps {
    count?: number;
}

const Skeleton = ({ className = '', style, children }: SkeletonProps) => (
    <div className={`animate-pulse rounded-md bg-app-border/60 ${className}`} style={style} aria-hidden="true">
        {children}
    </div>
);

export const SkeletonCard = ({ count = 1 }: SkeletonCardProps) => (
    <div aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
            <div
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are static and order-stable
                key={index}
                className="mb-4 rounded-xl border border-app-border bg-app-surface p-4 shadow-sm last:mb-0"
            >
                <div className="mb-3 flex items-center gap-2">
                    <Skeleton className="h-5 w-5 rounded-full" />
                    <Skeleton className="h-5 w-28" />
                </div>
                <Skeleton className="mb-2 h-4 w-full" />
                <Skeleton className="mb-2 h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
            </div>
        ))}
    </div>
);

export default Skeleton;
