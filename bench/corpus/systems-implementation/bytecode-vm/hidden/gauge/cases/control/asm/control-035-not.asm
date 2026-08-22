; case control-035-not
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  NOT
  PRINT
  RET
.end
