; case gc-029-reclaim
; expect exit=0 stdout="[]\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  POP
  NEW_ARRAY 0
  POP
  NEW_ARRAY 0
  POP
  NEW_ARRAY 0
  PRINT
  RET
.end
