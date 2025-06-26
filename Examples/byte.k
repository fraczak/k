$ bit = < {} 0, {} 1 >;
0 = {{} 0};
1 = {{} 1};

$ byte = { 
  bit 0, bit 1, bit 2, bit 3,
  bit 4, bit 5, bit 6, bit 7 
};

x00 = { 0 0, 0 1, 0 2, 0 3, 0 4, 0 5, 0 6, 0 7 };
xFF = { 1 0, 1 1, 1 2, 1 3, 1 4, 1 5, 1 6, 1 7 };

$ bytes = < {} nil, {bit car, bits cdr} cons >;
