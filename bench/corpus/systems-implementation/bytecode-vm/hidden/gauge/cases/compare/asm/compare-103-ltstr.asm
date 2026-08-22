; case compare-103-ltstr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "ab"
  PUSH_STR "b"
  LT
  PRINT
  RET
.end
