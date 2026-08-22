; case compare-101-ltstr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR "b"
  LT
  PRINT
  RET
.end
