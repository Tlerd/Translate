import { describe, expect, it } from 'vitest';
import { sonioxEndpointConfig } from '@/shared/soniox';

describe('sonioxEndpointConfig', () => {
  it('follows the pause setting inside Soniox limits', () => {
    expect(sonioxEndpointConfig(900).max_endpoint_delay_ms).toBe(900);
    expect(sonioxEndpointConfig(200).max_endpoint_delay_ms).toBe(500);
    expect(sonioxEndpointConfig(6000).max_endpoint_delay_ms).toBe(1500);
    expect(sonioxEndpointConfig(Number.NaN).max_endpoint_delay_ms).toBe(900);
  });

  it('always enables endpoint detection with the faster latency level', () => {
    expect(sonioxEndpointConfig(900)).toMatchObject({ enable_endpoint_detection: true, endpoint_latency_adjustment_level: 2 });
  });
});
