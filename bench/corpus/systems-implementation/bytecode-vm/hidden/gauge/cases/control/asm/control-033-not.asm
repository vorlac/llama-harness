; case control-033-not
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  NOT
  PRINT
  RET
.end
