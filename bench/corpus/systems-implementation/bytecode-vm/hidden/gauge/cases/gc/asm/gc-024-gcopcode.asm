; case gc-024-gcopcode
; expect exit=0 stdout="nil\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  GC
  PUSH_INT 1
  ARR_PUSH
  PUSH_NIL
  PRINT
  RET
.end
