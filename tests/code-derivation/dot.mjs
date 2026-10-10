import { t, in_out } from './index.mjs';
import { hash } from '../../hash.mjs';
import assert from 'assert';

t(`
1 = {} |1 ?< {} 0, {} 1 >;
?< {} true, {} false > {1 one, () two, () c} .one

`, (annotated) => {
    const {input,output} = in_out(annotated);
    assert.equal(input.type, "@GWnxJCupZr96BZfdpDsfQQKxKjCbjyDh7Qaur7y9enCY");
    assert.equal(output.type, "@MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg");
    console.log("OK");
});

t(`
    ?< <{} 0, {} 1> true, <{} 0, {} 1> false > /true
  `, (annotated) => {
  const {input,output} = in_out(annotated);
  console.log({input,output});
});

t(`
  x = /x;
  xy = x/y;
  f = { 
    {} | y | x xy i, 
    {} | y | x xy b 
  };
  f .b
`, (annotated) => {
  const {input,output} = in_out(annotated);
  console.log({input,output});
  assert.equal(input.pattern, '(...)');
    assert.equal(output.type, hash("$C0={};"));
    console.log("OK");
});
