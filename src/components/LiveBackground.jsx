import React, { useMemo, memo } from 'react';
import './LiveBackground.css';

// Memoized LiveBackground component for better performance
// Using key={theme} forces re-mount when theme changes, resetting all animations
const LiveBackground = memo(({ theme }) => {
    const isLive = ['cherry-blossom', 'bamboo-forest', 'ocean-depths'].includes(theme);

    if (!isLive) return null;

    return (
        <div key={theme} className="fixed inset-0 z-0 overflow-hidden pointer-events-none will-change-transform">
            {theme === 'cherry-blossom' && <CherryBlossom />}
            {theme === 'bamboo-forest' && <BambooForest />}
            {theme === 'ocean-depths' && <OceanDepths />}
        </div>
    );
});

// Optimized Cherry Blossom - Using CSS animations
const CherryBlossom = memo(() => {
    // 20 petals and 8 whole flowers
    const petals = useMemo(() => Array.from({ length: 20 }).map((_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 8,
        duration: 8 + Math.random() * 6,
        size: 16 + Math.random() * 12,
        variant: i % 3,
        type: 'petal'
    })), []);

    const flowers = useMemo(() => Array.from({ length: 8 }).map((_, i) => ({
        id: 100 + i,
        x: Math.random() * 100,
        delay: Math.random() * 10,
        duration: 10 + Math.random() * 8,
        size: 24 + Math.random() * 10,
        rotation: Math.random() * 360,
        type: 'flower'
    })), []);

    const allItems = [...petals, ...flowers];
    const colors = ['#f9a8d4', '#fda4af', '#f0abfc'];

    return (
        <div className="absolute inset-0 bg-gradient-to-b from-pink-100 via-rose-50 to-pink-50">
            <div className="absolute inset-0 bg-gradient-to-br from-pink-200/30 via-transparent to-rose-200/20" />

            {allItems.map((item) => (
                <div
                    key={item.id}
                    className="petal-fall"
                    style={{
                        left: `${item.x}%`,
                        width: item.size,
                        height: item.size * (item.type === 'flower' ? 1 : 1.2),
                        animationDuration: `${item.duration}s`,
                        animationDelay: `${item.delay}s`,
                    }}
                >
                    {item.type === 'petal' ? (
                        <svg viewBox="0 0 30 40" className="w-full h-full">
                            <path
                                d="M15,2 Q28,12 26,25 Q24,35 15,38 Q6,35 4,25 Q2,12 15,2 Z"
                                fill={colors[item.variant]}
                            />
                        </svg>
                    ) : (
                        <svg viewBox="0 0 40 40" className="w-full h-full opacity-90 spin-slow">
                            {/* 5-petal flower shape */}
                            <path d="M20,20 Q20,5 28,10 Q35,15 20,20 Z" fill="#fecdd3" transform="rotate(0 20 20)" />
                            <path d="M20,20 Q35,15 40,23 Q35,35 20,20 Z" fill="#fecdd3" transform="rotate(72 20 20)" />
                            <path d="M20,20 Q35,35 25,40 Q10,40 20,20 Z" fill="#fecdd3" transform="rotate(144 20 20)" />
                            <path d="M20,20 Q10,40 0,30 Q5,15 20,20 Z" fill="#fecdd3" transform="rotate(216 20 20)" />
                            <path d="M20,20 Q5,15 5,5 Q15,0 20,20 Z" fill="#fecdd3" transform="rotate(288 20 20)" />
                            <circle cx="20" cy="20" r="4" fill="#fb7185" />
                        </svg>
                    )}
                </div>
            ))}
        </div>
    );
});

// Optimized Bamboo Forest
const BambooForest = memo(() => {
    // Reduced from 30 to 15 particles and 20 to 10 leaves
    const particles = useMemo(() => Array.from({ length: 15 }).map((_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        duration: 3 + Math.random() * 4
    })), []);

    const leaves = useMemo(() => Array.from({ length: 10 }).map((_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 10,
        duration: 10 + Math.random() * 7,
    })), []);

    return (
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-100 via-green-200 to-teal-300 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-yellow-100/30 via-transparent to-emerald-900/20" />

            {/* Static bamboo stalks - no animation needed */}
            <BambooStalk x="2%" width={50} opacity={0.7} />
            <BambooStalk x="95%" width={60} opacity={0.7} />
            <BambooStalk x="-3%" width={70} opacity={1.0} />
            <BambooStalk x="90%" width={80} opacity={1.0} />

            {particles.map((p) => (
                <div
                    key={`p-${p.id}`}
                    className="particle-float absolute rounded-full bg-amber-400/60"
                    style={{
                        left: `${p.x}%`,
                        top: `${p.y}%`,
                        width: 6,
                        height: 6,
                        animationDuration: `${p.duration}s`,
                    }}
                />
            ))}

            {leaves.map((leaf) => (
                <div
                    key={`leaf-${leaf.id}`}
                    className="leaf-fall"
                    style={{
                        left: `${leaf.x}%`,
                        animationDuration: `${leaf.duration}s`,
                        animationDelay: `${leaf.delay}s`,
                    }}
                >
                    <svg width={35} height={12} viewBox="0 0 50 15" className="text-green-600">
                        <path d="M0,7.5 Q25,0 50,7.5 Q25,15 0,7.5 Z" fill="currentColor" />
                    </svg>
                </div>
            ))}
        </div>
    );
});

// Static Bamboo Stalk - removed animations
const BambooStalk = memo(({ x, width, opacity = 1 }) => {
    const segments = 8;

    return (
        <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: x, width, opacity }}
        >
            <svg viewBox="0 0 40 400" preserveAspectRatio="none" className="w-full h-full">
                {Array.from({ length: segments }).map((_, i) => {
                    const y = i * (400 / segments);
                    const h = 400 / segments;
                    return (
                        <g key={i}>
                            <rect x="8" y={y} width="24" height={h} rx="2" className="fill-emerald-600" />
                            <rect x="10" y={y + 2} width="6" height={h - 4} rx="2" className="fill-lime-400 opacity-50" />
                            <ellipse cx="20" cy={y + h} rx="14" ry="4" className="fill-teal-700" />
                        </g>
                    );
                })}
            </svg>
        </div>
    );
});

// Optimized Ocean Depths
const OceanDepths = memo(() => {
    // Significantly reduced: 50->20 bubbles, 60->0 particles, 10->5 fish
    const bubbles = useMemo(() => Array.from({ length: 20 }).map((_, i) => ({
        id: i,
        x: Math.random() * 100,
        size: 4 + Math.random() * 10,
        duration: 12 + Math.random() * 8,
        delay: Math.random() * 10
    })), []);

    const fishes = useMemo(() => Array.from({ length: 5 }).map((_, i) => ({
        id: i,
        type: i % 3,
        y: 15 + Math.random() * 55,
        duration: 20 + Math.random() * 15,
        delay: Math.random() * 10,
        direction: Math.random() > 0.5 ? 1 : -1,
        scale: 0.6 + Math.random() * 0.4
    })), []);

    return (
        <div className="absolute inset-0 overflow-hidden">
            {/* Static gradient backgrounds */}
            <div className="absolute inset-0 bg-gradient-to-b from-cyan-800 via-blue-900 to-slate-950" />

            {/* Static light rays */}
            <div className="absolute top-0 left-1/4 w-32 h-full bg-gradient-to-b from-cyan-300/20 via-cyan-400/5 to-transparent skew-x-6 blur-lg" />
            <div className="absolute top-0 right-1/4 w-40 h-full bg-gradient-to-b from-cyan-300/20 via-cyan-400/5 to-transparent skew-x-3 blur-lg" />

            {/* Depth fog */}
            <div className="absolute bottom-0 h-1/2 w-full bg-gradient-to-t from-slate-950/80 via-blue-950/40 to-transparent" />

            {/* Ocean floor */}
            <div className="absolute bottom-0 h-[10%] w-full bg-gradient-to-t from-stone-800 via-slate-700/60 to-transparent" />

            {/* Static coral reef */}
            <CoralReef />

            {/* CSS-animated seaweed - 4 plants */}
            <Seaweed x="5%" height={250} delay={0} color="#166534" />
            <Seaweed x="15%" height={180} delay={0.5} color="#15803d" />
            <Seaweed x="85%" height={200} delay={1.5} color="#166534" />
            <Seaweed x="92%" height={220} delay={1} color="#15803d" />

            {/* CSS-animated bubbles */}
            {bubbles.map((bubble) => (
                <div
                    key={`bubble-${bubble.id}`}
                    className="bubble-rise absolute rounded-full"
                    style={{
                        left: `${bubble.x}%`,
                        width: bubble.size,
                        height: bubble.size,
                        background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4), rgba(100,200,255,0.1))',
                        border: '1px solid rgba(255,255,255,0.2)',
                        animationDuration: `${bubble.duration}s`,
                        animationDelay: `${bubble.delay}s`,
                    }}
                />
            ))}

            {/* CSS-animated fish */}
            {fishes.map((fish) => (
                <div
                    key={`fish-${fish.id}`}
                    className={fish.direction === 1 ? 'fish-swim-right' : 'fish-swim-left'}
                    style={{
                        top: `${fish.y}%`,
                        width: 80 * fish.scale,
                        height: 50 * fish.scale,
                        animationDuration: `${fish.duration}s`,
                        animationDelay: `${fish.delay}s`,
                        transform: `scaleX(${fish.direction})`,
                    }}
                >
                    <SimpleFish type={fish.type} />
                </div>
            ))}
        </div>
    );
});

// Proper Coral Reef with SVG shapes
const CoralReef = memo(() => (
    <div className="absolute bottom-[3%] left-0 right-0 h-24 flex justify-around items-end pointer-events-none">
        {/* Brain Coral */}
        <svg viewBox="0 0 60 50" className="w-14 h-12 opacity-80">
            <ellipse cx="30" cy="35" rx="25" ry="15" fill="#f472b6" />
            <ellipse cx="25" cy="32" rx="8" ry="5" fill="#fbcfe8" />
            <ellipse cx="38" cy="30" rx="6" ry="4" fill="#fbcfe8" />
            <path d="M15,40 Q30,30 45,40" stroke="#ec4899" strokeWidth="2" fill="none" />
        </svg>

        {/* Branching Coral */}
        <svg viewBox="0 0 50 70" className="w-10 h-14 opacity-85">
            <path d="M25,70 L25,40 L15,20" stroke="#f97316" strokeWidth="4" fill="none" strokeLinecap="round" />
            <path d="M25,40 L35,15" stroke="#f97316" strokeWidth="4" fill="none" strokeLinecap="round" />
            <path d="M25,50 L20,30" stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round" />
            <circle cx="15" cy="18" r="5" fill="#fb923c" />
            <circle cx="35" cy="13" r="6" fill="#fb923c" />
            <circle cx="20" cy="28" r="4" fill="#fdba74" />
        </svg>

        {/* Fan Coral */}
        <svg viewBox="0 0 60 60" className="w-12 h-14 opacity-80">
            <path d="M30,60 L30,40" stroke="#a855f7" strokeWidth="3" fill="none" />
            <ellipse cx="20" cy="25" rx="12" ry="20" fill="#c084fc" opacity="0.7" />
            <ellipse cx="30" cy="20" rx="10" ry="18" fill="#a855f7" opacity="0.8" />
            <ellipse cx="40" cy="25" rx="12" ry="20" fill="#c084fc" opacity="0.7" />
        </svg>

        {/* Tube Coral */}
        <svg viewBox="0 0 50 60" className="w-10 h-12 opacity-85">
            <rect x="15" y="20" width="8" height="40" rx="4" fill="#facc15" />
            <rect x="27" y="25" width="7" height="35" rx="3" fill="#fde047" />
            <rect x="38" y="30" width="6" height="30" rx="3" fill="#eab308" />
            <circle cx="19" cy="18" r="6" fill="#fef08a" />
            <circle cx="30" cy="23" r="5" fill="#fef9c3" />
            <circle cx="41" cy="28" r="4" fill="#fef08a" />
        </svg>

        {/* Mushroom Coral */}
        <svg viewBox="0 0 50 40" className="w-12 h-10 opacity-80">
            <ellipse cx="25" cy="30" rx="22" ry="10" fill="#14b8a6" />
            <ellipse cx="25" cy="28" rx="18" ry="7" fill="#2dd4bf" />
            <path d="M10,32 Q25,22 40,32" stroke="#0f766e" strokeWidth="1" fill="none" />
        </svg>
    </div>
));

// Seaweed with CSS animation
const Seaweed = memo(({ x, height, delay, color = '#166534' }) => (
    <div
        className="seaweed-sway absolute bottom-0"
        style={{
            left: x,
            height,
            width: 35,
            animationDelay: `${delay}s`,
        }}
    >
        <svg viewBox="0 0 35 100" preserveAspectRatio="none" className="w-full h-full">
            <path d="M18,100 Q5,70 18,50 Q30,30 18,0" stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" />
            <path d="M12,100 Q0,60 12,30 Q22,10 12,0" stroke={color} strokeWidth="4" fill="none" opacity="0.7" strokeLinecap="round" />
            <path d="M25,100 Q35,65 25,35 Q15,15 25,0" stroke={color} strokeWidth="3" fill="none" opacity="0.5" strokeLinecap="round" />
        </svg>
    </div>
));

// Simplified fish SVGs - reduced complexity
const SimpleFish = memo(({ type }) => {
    const fishConfigs = [
        { body: '#ff6600', stripe: 'white' }, // Clownfish-like
        { body: '#0066cc', stripe: '#ffd700' }, // Blue tang-like
        { body: '#ffd000', stripe: 'white' }, // Yellow tang-like
    ];
    const config = fishConfigs[type];

    return (
        <svg viewBox="0 0 80 50" className="w-full h-full">
            {/* Tail */}
            <path d="M5,25 L15,15 L15,35 Z" fill={config.body} />
            {/* Body */}
            <ellipse cx="40" cy="25" rx="25" ry="18" fill={config.body} />
            {/* Stripe */}
            <rect x="35" y="10" width="4" height="30" rx="2" fill={config.stripe} opacity="0.8" />
            {/* Eye */}
            <circle cx="55" cy="22" r="4" fill="white" />
            <circle cx="56" cy="22" r="2" fill="black" />
            {/* Fin */}
            <path d="M35,25 Q45,35 40,40" stroke={config.body} strokeWidth="3" fill="none" />
        </svg>
    );
});

LiveBackground.displayName = 'LiveBackground';
CherryBlossom.displayName = 'CherryBlossom';
BambooForest.displayName = 'BambooForest';
BambooStalk.displayName = 'BambooStalk';
OceanDepths.displayName = 'OceanDepths';
CoralReef.displayName = 'CoralReef';
Seaweed.displayName = 'Seaweed';
SimpleFish.displayName = 'SimpleFish';

export default LiveBackground;
