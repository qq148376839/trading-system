import { calculateOptionsFees, estimateOptionOrderTotalCost } from '../options-fee.service';

describe('options-fee.service', () => {
  it('calculates fees with min commission for 1 contract', () => {
    const fees = calculateOptionsFees(1, {
      commissionPerContract: 0.1,
      minCommissionPerOrder: 0.99,
      platformFeePerContract: 0.3,
    });

    expect(fees.contracts).toBe(1);
    expect(fees.commission).toBe(0.99);
    expect(fees.platformFee).toBe(0.3);
    expect(fees.totalFees).toBe(1.29);
  });

  it('calculates fees for 10 contracts (commission no longer min)', () => {
    const fees = calculateOptionsFees(10, {
      commissionPerContract: 0.1,
      minCommissionPerOrder: 0.99,
      platformFeePerContract: 0.3,
    });

    expect(fees.contracts).toBe(10);
    expect(fees.commission).toBe(1.0);
    expect(fees.platformFee).toBe(3.0);
    expect(fees.totalFees).toBe(4.0);
  });

  it('estimates total option order cost with multiplier', () => {
    const est = estimateOptionOrderTotalCost({
      premium: 2.5,
      contracts: 2,
      multiplier: 100,
      feeModel: { commissionPerContract: 0.1, minCommissionPerOrder: 0.99, platformFeePerContract: 0.3 },
    });

    // premium cost: 2.5 * 100 * 2 = 500
    // fees: commission=max(0.99,0.2)=0.99, platform=0.6 -> 1.59
    expect(est.fees.totalFees).toBe(1.59);
    expect(est.totalCost).toBe(501.59);
  });
});

