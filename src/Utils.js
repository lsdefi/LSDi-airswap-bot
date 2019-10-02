import { getBalance } from './utils/getBalance.js';
import { signOrder } from './utils/signOrder.js';
import { validateHexString } from './utils/validateHexString.js';
import { wrapAsBigNumber } from './utils/wrapAsBigNumber.js';

export const Utils = {
  getBalance,
  signOrder,
  validateHexString,
  wrapAsBigNumber,
};

export default Utils;
