; case gc-003-array
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  GCLIVE
  PRINT
  RET
.end
