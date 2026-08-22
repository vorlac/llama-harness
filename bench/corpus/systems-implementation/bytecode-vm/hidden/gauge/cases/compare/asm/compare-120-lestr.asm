; case compare-120-lestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_STR "hello"
  LE
  PRINT
  RET
.end
