import { ethers } from 'ethers';

import { erc20Generic } from './abi/erc20Generic.js';
import { Utils } from './Utils.js';

export const AIRSWAP_EXCHANGE_ADDRESS = '0x8fd3121013a07c57f0d69646e86e7a4880b467b7';
export const DAI_ADDRESS = '0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359';

class MissingConfigError extends Error {}

const fetchConfig = (name, fallback, hex = false) => {
  if (!process.env[name] && !fallback) {
    const message = `Missing required config ENV var ${name}`;
    throw new MissingConfigError(message);
  }

  if (hex) {
    return Utils.validateHexString(process.env[name] || fallback);
  }

  return process.env[name] || fallback;
};

export class Configuration {
  constructor(overrides = {}) {
    this.airswapExchangeAddress = fetchConfig(
      'AIRSWAP_EXCHANGE_ADDRESS',
      AIRSWAP_EXCHANGE_ADDRESS,
    );
    this.collateralAddress = fetchConfig('COLLATERAL_ADDRESS', DAI_ADDRESS);
    this.defaultCollateralPrice = '1';
    this.erc20Contracts = {};
    this.jsonrpc = '2.0';
    this.marketContracts = fetchConfig('MARKET_CONTRACTS')
      .split(',')
      .map(addy => Utils.validateHexString(addy));
    this.privateKey = fetchConfig('PRIVATE_KEY');
    this.provider = overrides.provider || ethers.getDefaultProvider();
    this.wallet = new ethers.Wallet(this.privateKey, this.provider);

    this.signer = this.signer.bind(this);
  }

  get airswapRouterConfiguration() {
    return {
      address: this.wallet.address.toLowerCase(),
      keyspace: false,
      messageSigner: this.signer,
      requireAuthentication: true,
    };
  }

  get walletAddress() {
    return this.wallet.address.toLowerCase();
  }

  async decimalize(address, amount) {
    const contract = this.erc20Contract(address);
    const decimals = await contract.decimals();
    const base = await Utils.wrapAsBigNumber(amount);
    return base.dividedBy(10 ** decimals);
  }

  async collateralPrice() {
    return Utils.wrapAsBigNumber(this.defaultCollateralPrice);
  }

  async enableCollateralToken() {
    return this.enableToken(this.collateralAddress);
  }

  async enableToken(tokenAddress) {
    console.log('Enabling token', tokenAddress);

    const tokenContract = this.erc20Contract(tokenAddress);

    const approved = await Utils.wrapAsBigNumber(
      await tokenContract.allowance(this.walletAddress, this.airswapExchangeAddress),
    );

    if (approved.isGreaterThan(0)) {
      console.log('Already enabled', tokenAddress);
      return true;
    }

    console.log('Sending approve transaction', tokenAddress);

    const gasLimit = 160000;
    const gasPrice = ethers.utils.parseEther('0.000000040');

    return tokenContract.approve(
      this.airswapExchangeAddress,
      '115792089237316195423570985008687907853269984665640564039457584007913129639935', // max
      { gasLimit, gasPrice },
    );
  }

  erc20Contract(address) {
    if (this.erc20Contracts[address]) {
      return this.erc20Contracts[address];
    }

    console.log('Loading ERC20 Contract', address);
    this.erc20Contracts[address] = new ethers.Contract(address, erc20Generic, this.wallet);

    return this.erc20Contracts[address];
  }

  async integerize(address, amount) {
    const contract = this.erc20Contract(address);
    const decimals = await contract.decimals();
    const base = await Utils.wrapAsBigNumber(amount);
    return base.multipliedBy(10 ** decimals).decimalPlaces(0);
  }

  isCollateralToken(address) {
    return address === this.collateralAddress;
  }

  signer(data) {
    return this.wallet.signMessage(data);
  }
}

export default Configuration;
