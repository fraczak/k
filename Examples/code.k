$ code = < fields product, fields union, chars ref >;
$ fields = < {} nil, { chars car, fields cdr } cons >;
$ chars = < 
    chars a, chars b, chars c, chars d, 
    chars e, chars f, chars g, chars h, 
    chars i, chars j, chars k, chars l, 
    chars m, chars n, chars o, chars p, 
    chars q, chars r, chars s, chars t, 
    chars u, chars v, chars w, chars x, 
    chars y, chars z, 
    chars A, chars B, chars C, chars D, 
    chars E, chars F, chars G, chars H, 
    chars I, chars J, chars K, chars L, 
    chars M, chars N, chars O, chars P, 
    chars Q, chars R, chars S, chars T, 
    chars U, chars V, chars W, chars X, 
    chars Y, chars Z,
    chars 0, chars 1, chars 2, chars 3, 
    chars 4, chars 5, chars 6, chars 7, 
    chars 8, chars 9,
    {} "$" >;

nil = {}|nil;
_ = {}|"$";

KL = _|L|K;
 
bool =  
    { KL car, { KL car, nil cdr } | cons cdr } | cons | union
$code;

bool
