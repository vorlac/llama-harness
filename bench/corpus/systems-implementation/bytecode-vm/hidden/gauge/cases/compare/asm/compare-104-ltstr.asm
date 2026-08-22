; case compare-104-ltstr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "abd"
  LT
  PRINT
  RET
.end
