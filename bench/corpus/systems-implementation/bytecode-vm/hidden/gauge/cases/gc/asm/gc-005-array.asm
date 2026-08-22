; case gc-005-array
; expect exit=0 stdout="3\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  NEW_ARRAY 0
  NEW_ARRAY 0
  GCLIVE
  PRINT
  RET
.end
