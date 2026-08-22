; case control-031-not
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR ""
  NOT
  PRINT
  RET
.end
