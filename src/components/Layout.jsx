import React from 'react';
import { Outlet } from 'react-router-dom';
import BottomNavigation from './BottomNavigation';

const Layout = ({ children }) => {
    return (
        <div className="flex flex-col min-h-screen">
            {/* Header and Background are handled in App.jsx or passed as children */}
            {children}

            <main className="flex-1 pb-20"> {/* Padding bottom for navigation bar */}
                <Outlet />
            </main>

            <BottomNavigation />
        </div>
    );
};

export default Layout;
