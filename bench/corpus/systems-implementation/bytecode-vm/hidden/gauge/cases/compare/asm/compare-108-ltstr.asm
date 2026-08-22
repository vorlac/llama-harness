; case compare-108-ltstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_STR "hello"
  LT
  PRINT
  RET
.end
