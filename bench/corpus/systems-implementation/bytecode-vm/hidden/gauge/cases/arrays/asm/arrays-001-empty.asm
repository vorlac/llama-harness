; case arrays-001-empty
; expect exit=0 stdout="[]\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  PRINT
  RET
.end
