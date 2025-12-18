$ code = < fields product, fields union, chars ref >;
$ fields = < {} nil, { chars car, fields cdr } cons >;
$ chars = < 
    chars" ", chars"!", chars'"', chars"#", chars"$", chars"%", chars"&", chars"'", 
    chars"(", chars")", chars"*", chars"+", chars",", chars"-", chars".", chars"/", 
    chars"0", chars"1", chars"2", chars"3", chars"4", chars"5", chars"6", chars"7", 
    chars"8", chars"9", chars":", chars";", chars"<", chars"=", chars">", chars"?", 
    chars"@", chars"A", chars"B", chars"C", chars"D", chars"E", chars"F", chars"G", 
    chars"H", chars"I", chars"J", chars"K", chars"L", chars"M", chars"N", chars"O", 
    chars"P", chars"Q", chars"R", chars"S", chars"T", chars"U", chars"V", chars"W", 
    chars"X", chars"Y", chars"Z", chars"[", chars"\\", chars"]", chars"^", chars"_", 
    chars"`", chars"a", chars"b", chars"c", chars"d", chars"e", chars"f", chars"g", 
    chars"h", chars"i", chars"j", chars"k", chars"l", chars"m", chars"n", chars"o", 
    chars"p", chars"q", chars"r", chars"s", chars"t", chars"u", chars"v", chars"w", 
    chars"x", chars"y", chars"z", chars"{", chars"|", chars"}", chars"~",
    {} end
 >;
 
 $ char = <
    {}" ", {}"!", {}'"', {}"#", {}"$", {}"%", {}"&", {}"'", 
    {}"(", {}")", {}"*", {}"+", {}",", {}"-", {}".", {}"/", 
    {}"0", {}"1", {}"2", {}"3", {}"4", {}"5", {}"6", {}"7", 
    {}"8", {}"9", {}":", {}";", {}"<", {}"=", {}">", {}"?", 
    {}"@", {}"A", {}"B", {}"C", {}"D", {}"E", {}"F", {}"G", 
    {}"H", {}"I", {}"J", {}"K", {}"L", {}"M", {}"N", {}"O", 
    {}"P", {}"Q", {}"R", {}"S", {}"T", {}"U", {}"V", {}"W", 
    {}"X", {}"Y", {}"Z", {}"[", {}"\\", {}"]", {}"^", {}"_", 
    {}"`", {}"a", {}"b", {}"c", {}"d", {}"e", {}"f", {}"g", 
    {}"h", {}"i", {}"j", {}"k", {}"l", {}"m", {}"n", {}"o", 
    {}"p", {}"q", {}"r", {}"s", {}"t", {}"u", {}"v", {}"w", 
    {}"x", {}"y", {}"z", {}"{", {}"|", {}"}", {}"~"
 >;


nil = {}|nil;
_ = {}|end $chars;

KL = _|L|K $chars;
 
bool =  
    { KL car, { KL car, nil cdr } | cons cdr } | cons | union
$code;

bool
