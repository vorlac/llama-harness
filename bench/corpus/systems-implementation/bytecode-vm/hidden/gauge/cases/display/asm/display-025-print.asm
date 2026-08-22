; case display-025-print
; expect exit=0 stdout="\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PRINT
  RET
.end
