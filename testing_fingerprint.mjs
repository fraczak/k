import k from "./index.mjs";

import blake from 'blakejs';
import crypto from 'crypto';

function logCeiling(n, base = 2) {
  // Calculate the logarithm of n with the specified base
  const logValue = Math.log(n) / Math.log(base);
  
  // Apply the ceiling function to the logarithm value
  return Math.ceil(logValue);
}



// Function to generate a key from a secret string using PBKDF2
function deriveKey(secret, salt='salt', keyLength=10) {
  return crypto.pbkdf2Sync(secret, salt, 100000, keyLength, 'sha256');
}
function generateFingerprint(input,key = null) {
  const hash = blake.blake2b(input, key, logCeiling(input.length,8)); 
  const fingerprint = Buffer.from(hash).toString('hex');
  return 'C'+fingerprint.toUpperCase();
}

function codeToString(code, codes) {
  var i = 0;
  const Q = [[code,i]];
  const D = {[code]: i++};
  var result="";
  while (Q.length > 0) {
    const [x,c] = Q.shift();
    const c_code = codes[x];
    if (c_code === undefined) {
      // result += `$${c}=${JSON.stringify(x)};`;
      result += `${JSON.stringify(x)}`;
      continue;
    }
    const u_args =  Object.keys(c_code[c_code.code]).sort().map((k) => {
      const u_arg = c_code[c_code.code][k];
      if (D[u_arg] === undefined) {
        Q.push([u_arg,i]);
        D[u_arg] = i++;
      }
      return `${JSON.stringify(k)}:${D[u_arg]}`;
    });
    if (c_code.code == "union") {
      //result += `$${c}=<${u_args.join(",")}>;`;
      result += `<${u_args.join(",")}>`;
    } else if (c_code.code == "product") {
      //result += `$${c}={${u_args.join(",")}};`;
      result += `{${u_args.join(",")}}`;
    } else {
      throw new Error(`Unexpected code ${c_code.code}`);
    }
  }
  return result;
};

[
  `
  $nat = < {} zero, nat succ>;
  $pair = {nat x, nat y};
  $b = {int x, bool y};
  $tree = <{int value, tree left, tree right} binary, {int value} leaf, {int value, tree tree} unary>;

  succ = { $nat succ} $nat;
  plus = $pair <
    {.x.zero stop, .y result} .result,
    {.x.succ x, .y succ y } plus
  > $nat;
{{} zero} succ succ {() x, () y} plus
  `     
].map(function (script) {
  console.log(`k_expression = '${script}';`);
  console.log(`// EVALUATE : ${JSON.stringify(k.run(script,"?"))}`);
  const annotated = k.annotate(script);
  console.log(`// CODES: ${JSON.stringify(annotated.codes,"",2)}`);
  for (const code in annotated.codes) {
    console.log(`// CODE: ${code}`);
    const s = codeToString(code,annotated.codes);
    console.log(generateFingerprint(s,deriveKey('kupa')));
    console.log(generateFingerprint(s), s);
  }
});