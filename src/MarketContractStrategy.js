import { getBalance } from './utils/getBalance.js';
import { MarketContractPricer } from './MarketContractPricer.js';
import { MarketContractWrapper } from './MarketContractWrapper.js';
import { SanityChecker } from './SanityChecker.js';
import { wrapAsBigNumber } from './utils/wrapAsBigNumber.js';

export class MarketContractStrategy {
  constructor(address, config) {
    this.address = address.toLowerCase();
    this.config = config;
    this.contract = new MarketContractWrapper(this);
    this.marketContracts = {};
    this.price = new MarketContractPricer(this);
    this.sanity = new SanityChecker(this);
  }

  async enableTokens() {
    const { longAddress, shortAddress } = await this.contract.tokenAddresses();
    await this.config.enableToken(longAddress);
    await this.config.enableToken(shortAddress);
    return true;
  }

  async getAmounts(makerAmount, makerToken, takerAmount, takerToken) {
    const makerPrice = await this.price.get(makerToken, 'maker');
    const takerPrice = await this.price.get(takerToken, 'taker');
    let makerAmountD;
    let takerAmountD;

    if (takerAmount) {
      takerAmountD = await this.config.decimalize(takerToken, takerAmount);
      makerAmountD = takerPrice.multipliedBy(takerAmountD).dividedBy(makerPrice);
    }

    if (makerAmount) {
      makerAmountD = await this.config.decimalize(makerToken, makerAmount);
      takerAmountD = makerPrice.multipliedBy(makerAmountD).dividedBy(takerPrice);
    }

    const makerAmountI = await this.config.integerize(makerToken, makerAmountD);
    const takerAmountI = await this.config.integerize(takerToken, takerAmountD);

    return { makerAmountD, makerAmountI, makerPrice, takerAmountD, takerAmountI,  takerPrice };
  }

  async getQuote(params) {
    const { makerAmount, makerToken, takerAmount, takerToken } = params;
    const makerAddress = this.config.walletAddress;

    const amounts = await this.getAmounts(makerAmount, makerToken, takerAmount, takerToken);
    console.log('AMOUNTS', amounts);

    let { makerAmountD, takerAmountD } = amounts;
    const { makerPrice, takerPrice } = amounts;

    if (this.config.isCollateralToken(makerToken)) {
      const max = this.maxPurchase();

      if (takerAmountD.isGreaterThan(max)) {
        takerAmountD = max;
        makerAmountD = takerPrice.multipliedBy(takerAmountD).dividedBy(makerPrice);
      }
    } else {
      const max = this.maxSale();

      if (makerAmountD.isGreaterThan(max)) {
        makerAmountD = max;
        takerAmountD = makerPrice.multipliedBy(makerAmountD).dividedBy(takerPrice);
      }
    }

    return {
      makerAddress,
      makerToken,
      takerToken,

      makerAmount: (await this.config.integerize(makerToken, makerAmountD)).toFixed(),
      takerAmount: (await this.config.integerize(takerToken, takerAmountD)).toFixed(),
    };
  }

  async getMaxQuote(params) {
    const { makerToken, takerToken } = params;
    const makerAddress = this.config.walletAddress;
    const makerPrice = await this.price.get(makerToken, 'maker');
    const takerPrice = await this.price.get(takerToken, 'taker');
    let makerAmountD;
    let takerAmountD;

    if (this.config.isCollateralToken(makerToken)) {
      takerAmountD = this.maxPurchase();
      makerAmountD = takerPrice.multipliedBy(takerAmountD).dividedBy(makerPrice);
    } else {
      makerAmountD = this.maxSale();
      takerAmountD = makerPrice.multipliedBy(makerAmountD).dividedBy(takerPrice);
    }

    return {
      makerAddress,
      makerToken,
      takerToken,

      makerAmount: (await this.config.integerize(makerToken, makerAmountD)).toFixed(),
      takerAmount: (await this.config.integerize(takerToken, takerAmountD)).toFixed(),
    };
  }

  async intents() {
    const role = 'maker';
    const supportedMethods = ['getOrder', 'getQuote', 'getMaxQuote'];

    const base = { role, supportedMethods };
    const { collateralAddress } = this.config;
    const { longAddress, shortAddress } = await this.contract.tokenAddresses();

    const combinations = [
      { makerToken: collateralAddress, takerToken: longAddress },
      { makerToken: longAddress, takerToken: collateralAddress },
      { makerToken: collateralAddress, takerToken: shortAddress },
      { makerToken: shortAddress, takerToken: collateralAddress },
    ];

    return combinations.map(combo => Object.assign({}, base, combo));
  }

  async match({ makerToken, takerToken }) {
    const { longAddress, shortAddress } = await this.contract.tokenAddresses();
    const makerAddress = makerToken.toLowerCase();
    const takerAddress = takerToken.toLowerCase();

    return (
      makerAddress === longAddress
      || makerAddress === shortAddress
      || takerAddress === longAddress
      || takerAddress === shortAddress
    );
  }

  async maxPurchase() {
    const spread = await this.contract.bandSpread();

    if (spread.isLessThan(150)) {
      return wrapAsBigNumber(2.5);
    }

    return wrapAsBigNumber(0.1);
  }

  async maxSale() {
    return this.maxPurchase();
  }

  async validateBalances({ makerAmount, makerToken, takerAddress, takerAmount, takerToken }) {
    if (!makerAmount && !takerAmount) {
      console.log('NULL amount order halted');
      return false;
    }

    const {
      makerAmountD,
      makerAmountI,
      makerPrice,
      takerAmountD,
      takerAmountI,
      takerPrice,
    } = await this.getAmounts(makerAmount, makerToken, takerAmount, takerToken);

    if (makerAmountD.isZero()) {
      console.log('Zero amount order request halted');
      return false;
    }

    const makerBalance = await getBalance(this.config.walletAddress, makerToken, this.config);
    console.log('MAKER BALANCE', makerBalance.toFixed());

    if (makerBalance.isLessThan(makerAmountI)) {
      console.log(
        'Insufficient maker balance',
        makerAmountI.toFixed(),
        '<',
        makerBalance.toFixed(),
      );
      return false;
    }

    const takerBalance = await getBalance(takerAddress, takerToken, this.config);

    console.log('TAKER BALANCE', takerBalance.toFixed());

    if (takerBalance.isLessThan(takerAmountI)) {
      console.log(
        'Insufficient taker balance',
        takerBalance.toFixed(),
        '<',
        takerAmountI.toFixed(),
      );
      return false;
    }

    return {
      makerAmountD,
      makerPrice,
      takerAmountD,
      takerPrice,

      makerAmount: makerAmountI,
      takerAmount: takerAmountI,
    };
  }
}

export default MarketContractStrategy;
