; case display-065-closure
; expect exit=0 stdout="[<fn helper>]\n"
.func main arity=0 locals=0
  CLOSURE helper
  NEW_ARRAY 1
  PRINT
  RET
.end
.func helper arity=0 locals=0
  PUSH_NIL
  RET
.end
