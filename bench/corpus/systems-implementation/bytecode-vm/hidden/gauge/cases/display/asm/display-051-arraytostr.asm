; case display-051-arraytostr
; expect exit=0 stdout="[\"\\t\"]\n"
.func main arity=0 locals=0
  PUSH_STR "\t"
  NEW_ARRAY 1
  TOSTR
  PRINT
  RET
.end
