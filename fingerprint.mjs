import k from "./index.mjs";

import blake from 'blakejs';
import crypto from 'crypto';


function isBuiltIn(code) {  
  return code.match(/^(int|string|bool)$/);
}

function logCeiling(n, base = 2) {
  return Math.ceil(Math.log(n) / Math.log(base));
}

function encodeCodeToString(code, codes) {
  if (isBuiltIn(code)) return code;
  var i = 0;
  const Q = [[code,i]];
  const D = {[code]: i++};
  var result=[];
  while (Q.length > 0) {
    const [x,c] = Q.shift();
    const c_code = codes[x];
    if (c_code.code == "vector") {
      const u_arg = c_code.vector;
      if (isBuiltIn(u_arg)) {
        result.push(`$C${result.length}=[${u_arg}];`);
        continue;
      }
      if (D[u_arg] === undefined) {
        Q.push([u_arg,i]);
        D[u_arg] = i++;
      }
      result.push(`$C${result.length}=[C${D[u_arg]}];`);
      continue;
    }
    const u_args =  Object.keys(c_code[c_code.code]).sort().map((k) => {
      const u_arg = c_code[c_code.code][k];
      if (isBuiltIn(u_arg)) 
        return `${u_arg}${JSON.stringify(k)}`;
      if (D[u_arg] === undefined) {
        Q.push([u_arg,i]);
        D[u_arg] = i++;
      }
      return `C${D[u_arg]}${JSON.stringify(k)}`;
    });
    if (c_code.code == "union") {
      //result += `$${c}=<${u_args.join(",")}>;`;
      result.push(`$C${result.length}=<${u_args.join(",")}>;`);
    } else if (c_code.code == "product") {
      //result += `$${c}={${u_args.join(",")}};`;
      result.push(`$C${result.length}={${u_args.join(",")}};`);
    } else {
      throw new Error(`Unexpected code ${c_code.code}`);
    }
  }
  return result.join("");
};

function fingerprint(input,key = null) {
  const hash = blake.blake2b(input, key, logCeiling(input.length-5,5)); 
  const hex = Buffer.from(hash).toString('hex');
  return Array.from(hex).map((c) => String.fromCharCode(c.charCodeAt(0)+17)).join('').toUpperCase();
}


export default { fingerprint, encodeCodeToString };
export { fingerprint, encodeCodeToString };
