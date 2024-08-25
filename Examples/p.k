x = .x;
xy = x.y;
xyz = xy.z;
xyzv = xyz.v;

gx = {() x};
gy = {() y};
gz = {() z};
gv = {() v};

g = gv gz gy gx;

f = { 
  5 g xyzv i, 
  true g xyzv b 
};

f .i $int 

-- $ echo '[8,false]' | ./k.mjs -k Examples/p.k