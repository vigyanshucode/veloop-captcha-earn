import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useCaptcha from './useCaptcha';

vi.mock('../services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import api from '../services/api';

const mockChallenge = {
  challengeId: 'ch-123',
  captchaText: 'ABC123',
  options: ['ABC123', 'ABD123', 'XYZ789', 'XXX000'],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  status: 'ACTIVE',
};

const flushMicrotasks = () => new Promise((r) => r());

describe('useCaptcha - duplicate verification guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.get.mockReset();
    api.post.mockReset();
    api.get.mockResolvedValue({ data: { success: true, data: mockChallenge } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderAndLoad = async () => {
    const { result } = renderHook(() => useCaptcha());
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(result.current.challenge).toEqual(mockChallenge);
    expect(result.current.step).toBe('IDLE');
    return result;
  };

  it('one option selection triggers exactly one /verify request', async () => {
    api.post.mockResolvedValue({
      data: { success: true, data: { isCorrect: true, rewardAmount: 1, rewardStatus: 'PENDING' } },
    });

    const result = await renderAndLoad();

    await act(async () => {
      result.current.selectOption('ABC123');
      await vi.advanceTimersByTimeAsync(200);
      await flushMicrotasks();
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/captcha/verify', {
      challengeId: 'ch-123',
      selectedOption: 'ABC123',
    });
    expect(result.current.step).toBe('SUCCESS');
  });

  it('two rapid selections before the 160ms delay still trigger only one /verify', async () => {
    api.post.mockResolvedValue({
      data: { success: true, data: { isCorrect: true, rewardAmount: 1, rewardStatus: 'PENDING' } },
    });

    const result = await renderAndLoad();

    await act(async () => {
      result.current.selectOption('ABC123');
      result.current.selectOption('ABC123');
      await vi.advanceTimersByTimeAsync(200);
      await flushMicrotasks();
    });

    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('a duplicate selection while verification is in flight is ignored and does NOT enter ERROR', async () => {
    let resolveVerify;
    api.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVerify = resolve;
        })
    );

    const result = await renderAndLoad();

    await act(async () => {
      result.current.selectOption('ABC123');
      await vi.advanceTimersByTimeAsync(200);
      await flushMicrotasks();
    });
    expect(result.current.step).toBe('VERIFYING');

    await act(async () => {
      result.current.selectOption('ABD123');
      await flushMicrotasks();
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(result.current.step).toBe('VERIFYING');
    expect(result.current.lastError).toBeNull();

    await act(async () => {
      resolveVerify({
        data: { success: true, data: { isCorrect: false, rewardAmount: 0.5, rewardStatus: 'PENDING' } },
      });
      await flushMicrotasks();
    });

    expect(result.current.step).toBe('INCORRECT');
    expect(result.current.lastError).toBeNull();
  });

  it('after verification the claim flow still works (SUCCESS -> AD_READY -> CLAIMED)', async () => {
    api.post.mockImplementation(async (path) => {
      if (path === '/captcha/verify') {
        return { data: { success: true, data: { isCorrect: true, rewardAmount: 1, rewardStatus: 'PENDING' } } };
      }
      if (path === '/captcha/ad-complete') {
        return { data: { success: true, data: { rewardStatus: 'PENDING', rewardAmount: 1 } } };
      }
      if (path === '/captcha/claim') {
        return { data: { success: true, data: { rewardAmount: 1, status: 'CLAIMED', gems: 5 } } };
      }
      return { data: { success: true } };
    });

    const result = await renderAndLoad();

    await act(async () => {
      result.current.selectOption('ABC123');
      await vi.advanceTimersByTimeAsync(200);
      await flushMicrotasks();
    });
    expect(result.current.step).toBe('SUCCESS');

    await act(async () => {
      await result.current.watchAd();
      await flushMicrotasks();
    });
    expect(result.current.step).toBe('AD_READY');

    await act(async () => {
      await result.current.claimReward();
      await flushMicrotasks();
    });
    expect(result.current.step).toBe('CLAIMED');
    expect(result.current.walletGems).toBe(5);
  });
});
