import type { LayoutProps } from '../../types';
import BottomNavigation from './BottomNavigation';

const Layout = ({ children }: LayoutProps) => {
    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 pb-page-navigation">{children}</div>
            <BottomNavigation />
        </div>
    );
};

export default Layout;
