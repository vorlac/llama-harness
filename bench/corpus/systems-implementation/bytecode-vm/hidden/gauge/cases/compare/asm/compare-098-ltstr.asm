; case compare-098-ltstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR ""
  LT
  PRINT
  RET
.end
