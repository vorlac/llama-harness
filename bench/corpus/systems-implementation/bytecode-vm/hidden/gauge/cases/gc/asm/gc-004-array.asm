; case gc-004-array
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  POP
  GCLIVE
  PRINT
  RET
.end
