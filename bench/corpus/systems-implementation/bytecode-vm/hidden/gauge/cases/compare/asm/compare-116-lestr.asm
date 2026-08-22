; case compare-116-lestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "abd"
  LE
  PRINT
  RET
.end
