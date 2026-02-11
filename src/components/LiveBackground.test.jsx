import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LiveBackground from './LiveBackground';

describe('LiveBackground', () => {
    it('renders nothing when theme is not live', () => {
        const { container } = render(<LiveBackground theme="light" />);
        expect(container).toBeEmptyDOMElement();

        const { container: container2 } = render(<LiveBackground theme="dark" />);
        expect(container2).toBeEmptyDOMElement();
    });

    it('renders CherryBlossom content when theme is cherry-blossom', () => {
        // We can check for specific class names or structure that defines CherryBlossom
        const { container } = render(<LiveBackground theme="cherry-blossom" />);
        // CherryBlossom has a gradient from-pink-50
        expect(container.querySelector('.from-pink-50')).toBeInTheDocument();
    });

    it('renders BambooForest content when theme is bamboo-forest', () => {
        const { container } = render(<LiveBackground theme="bamboo-forest" />);
        // BambooForest has a gradient from-green-50
        expect(container.querySelector('.from-green-50')).toBeInTheDocument();
        // Should have bamboo stalks
        const stalks = container.querySelectorAll('.border-emerald-900\\/10'); // Escaping slash for selector
        expect(stalks.length).toBeGreaterThan(0);
    });

    it('renders OceanDepths content when theme is ocean-depths', () => {
        const { container } = render(<LiveBackground theme="ocean-depths" />);
        // OceanDepths has a gradient from-blue-950
        expect(container.querySelector('.from-blue-950')).toBeInTheDocument();
        // Should have fish SVGs
        const fish = container.querySelectorAll('svg');
        expect(fish.length).toBeGreaterThan(0);
    });
});
