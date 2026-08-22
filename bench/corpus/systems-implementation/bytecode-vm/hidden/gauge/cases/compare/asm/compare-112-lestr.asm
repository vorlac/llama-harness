; case compare-112-lestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR "a"
  LE
  PRINT
  RET
.end
