/* eslint class-methods-use-this: 0 */
import { wrapAsBigNumber } from './utils/wrapAsBigNumber.js';

class ExceedsBandError extends Error {}
class NotAboveZeroError extends Error {}
class NotNumericError extends Error {}

export class SanityChecker {
  constructor(strategy) {
    this.strategy = strategy;
  }

  get contract() {
    return this.strategy.contract;
  }

  async greaterThanZero(value) {
    const num = await wrapAsBigNumber(value);

    if (num.isGreaterThan(0)) {
      return;
    }

    throw new NotAboveZeroError(`The value, ${num.toFixed()}, is not greater than 0`);
  }

  async isNumeric(value) {
    const num = await wrapAsBigNumber(value);

    if (num.isNaN()) {
      throw new NotNumericError('The value is not numeric');
    }
  }

  async lessThanBand(value) {
    const num = await wrapAsBigNumber(value);
    const bandSpread = await wrapAsBigNumber(this.contract.bandSpread());

    if (num.isGreaterThan(bandSpread)) {
      throw new ExceedsBandError(
        `The quote (${num.toFixed}) would exceed the maximum token value (${bandSpread.toFixed})`,
      );
    }
  }
}

export default SanityChecker;
