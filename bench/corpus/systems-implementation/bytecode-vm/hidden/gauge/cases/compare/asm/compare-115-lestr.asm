; case compare-115-lestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "ab"
  PUSH_STR "b"
  LE
  PRINT
  RET
.end
