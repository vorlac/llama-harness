; case compare-092-nestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "abd"
  NE
  PRINT
  RET
.end
